#!/usr/bin/env bash
# Retired burner binding/crawl creation must reject; isolated PostgreSQL seeds
# historical in-flight tasks and exercises the retained HTTP receipts/readback.
# This is not Skill or Android device acceptance.

set -euo pipefail

# 自检前置 ENV
[ -z "${API_BASE:-}" ] && { echo "FAIL: API_BASE 未设置"; exit 99; }
[ -z "${DB:-}" ] && { echo "FAIL: DB 未设置"; exit 99; }
[ -z "${FEISHU_API_BASE:-}" ] && { echo "FAIL: 未设置 FEISHU_API_BASE，CI 模式必须指向 fake server"; exit 99; }
[ -z "${SMOKE_TOKEN:-}" ] && { echo "FAIL: SMOKE_TOKEN 未设置（_smoke helper 必需）"; exit 99; }

echo "=== Step 1: 建 tenant + 飞书 binding seed ==="
TENANT_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('smoke-b1-${RANDOM}', 'smoke-b1-key-${RANDOM}', 'free') RETURNING id" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
psql "$DB" -c "INSERT INTO zenithjoy.tenant_feishu_bindings (tenant_id, tenant_access_token, expires_at, app_token, table_id_lead_profile, table_id_target_videos, table_id_leads, bound_at) VALUES ('$TENANT_ID', 'fake_t_b1', NOW()+interval'1 hour', 'bascn_b1_app', 'tbl_b1_profile', 'tbl_b1_videos', 'tbl_b1_leads', NOW())" >/dev/null

# 飞书绑定状态查询
curl -fsS -X GET "$API_BASE/api/feishu/oauth/status" -H "X-Tenant-Id: $TENANT_ID" \
  | jq -e '.data.bound == true' >/dev/null \
  || { echo "FAIL Step 1: 飞书 binding 状态非 bound"; exit 1; }

echo "=== Step 2: 旧绑定创建拒绝 + 种历史在途任务 ==="
AGENT_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, status) VALUES ('$TENANT_ID', 'mac-b1-${RANDOM}', 'rog-test', 'online') RETURNING id" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
# Old creation is retired; seed a pre-existing task in disposable PG and
# test the retained HTTP callback without pretending a new task was dispatched.
RFILE=$(mktemp); trap 'rm -f "$RFILE"' EXIT
CODE=$(curl -s -o "$RFILE" -w '%{http_code}' -X POST "$API_BASE/api/agent/burner/qr-bind" \
 -H 'Content-Type: application/json' -d "{\"tenant_id\":\"$TENANT_ID\",\"agent_id\":\"$AGENT_ID\",\"account_label\":\"装修小号1\"}")
[ "$CODE" = 410 ] && jq -e '.error.code == "LEGACY_ACQUISITION_RETIRED"' "$RFILE" >/dev/null || { echo "FAIL: retired qr-bind expected 410"; exit 1; }
TASK_ID_NEW=$(psql "$DB" -At -c "INSERT INTO zenithjoy.publish_tasks (tenant_id,agent_id,platform,status,task_type,payload) VALUES ('$TENANT_ID','$AGENT_ID','douyin','queued','qr_bind/douyin_burner',jsonb_build_object('tenant_id','$TENANT_ID','agent_id','$AGENT_ID','account_label','装修小号1')) RETURNING id" | head -1)
[ -n "$TASK_ID_NEW" ] || { echo "FAIL historical bind fixture"; exit 1; }

echo "=== Step 3: fake-agent 模拟 chrome launched ==="
curl -fsS -X POST "$API_BASE/api/_smoke/fake-agent-burner-progress" \
  -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$TASK_ID_NEW\",\"phase\":\"chrome_launched\",\"user_data_dir\":\"/tmp/zj-burner/$AGENT_ID\",\"current_url\":\"https://creator.douyin.com/login\"}" >/dev/null

PHASE=$(psql "$DB" -t -A -c "SELECT response->>'phase' FROM zenithjoy.publish_tasks WHERE id='$TASK_ID_NEW' AND updated_at > NOW() - interval '60 seconds'" | tr -d ' ')
[ "$PHASE" = "chrome_launched" ] || { echo "FAIL Step 3: task phase != chrome_launched got '$PHASE'"; exit 1; }

echo "=== Step 4: 模拟历史扫码任务回执 ==="
curl -fsS -X POST "$API_BASE/api/agent/burner/qr-bind-result" \
  -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$TASK_ID_NEW\",\"agent_id\":\"$AGENT_ID\",\"qr_login\":\"success\",\"cookie_local_path\":\"/tmp/zj-burner/sessions/douyin/burner/装修小号1.json\",\"account_nickname\":\"装修达人小号\"}" >/dev/null

STATUS=$(psql "$DB" -t -A -c "SELECT status FROM zenithjoy.publish_tasks WHERE id='$TASK_ID_NEW' AND updated_at > NOW() - interval '60 seconds'" | tr -d ' ')
[ "$STATUS" = "done" ] || { echo "FAIL Step 4: task 未 done, got '$STATUS'"; exit 1; }

# 验证 cookie 路径含 /burner/ 子目录
COOKIE_PATH=$(psql "$DB" -t -A -c "SELECT response->>'cookie_local_path' FROM zenithjoy.publish_tasks WHERE id='$TASK_ID_NEW'")
echo "$COOKIE_PATH" | grep -q "/burner/" || { echo "FAIL Step 4: cookie path 未含 /burner/: $COOKIE_PATH"; exit 1; }

echo "=== Step 4b: fake-agent 首次扫描上报，归一 pending 占位为真实昵称 ==="
# 2026-07-22 account_label 语义统一 sprint 之后，qr-bind-result 只落
# pending:<task_id> 占位（不再直接采用调用方传入的 account_label/account_nickname），
# 真实账号名要靠 account-scan-result 归一。真实 Android 客户端在 qr-bind-result 后
# 一定会紧跟着报一次扫描结果；这里补上同一步，让本 smoke 反映真实生产链路，
# 后续 Step 7 才能按账号名 "装修小号1" 查到已归一的 burner session。
curl -fsS -X POST "$API_BASE/api/agent/burner/account-scan-result" \
  -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$AGENT_ID\",\"ok\":true,\"account_ids\":[\"装修小号1\"]}" >/dev/null

echo "=== Step 5: 验证 agent_platform_sessions 写入 burner 行 ==="
SESSION_COUNT=$(psql "$DB" -t -A -c "SELECT count(*) FROM zenithjoy.agent_platform_sessions WHERE agent_id='$AGENT_ID' AND platform='douyin' AND role='burner' AND status='active' AND created_at > NOW() - interval '60 seconds'")
[ "$SESSION_COUNT" = "1" ] || { echo "FAIL Step 5: burner session 写入数 $SESSION_COUNT"; exit 1; }

echo "=== Step 6: dashboard 查询 burner sessions ==="
curl -fsS "$API_BASE/api/agent/burner/sessions" -H "X-Tenant-Id: $TENANT_ID" \
  | jq -e '.data.sessions | length >= 1' >/dev/null \
  || { echo "FAIL Step 6: 无 burner sessions"; exit 1; }

echo "=== Step 7: 旧采集创建拒绝 + 种历史在途任务 ==="
# Old collection creation is retired; simulate only an in-flight historical
# row. The result callback and persisted status/leads remain real HTTP+PG.
CODE=$(curl -s -o "$RFILE" -w '%{http_code}' -X POST "$API_BASE/api/agent/burner/crawl-comments" \
 -H 'Content-Type: application/json' -d "{\"tenant_id\":\"$TENANT_ID\",\"agent_id\":\"$AGENT_ID\"}")
[ "$CODE" = 410 ] && jq -e '.error.code == "LEGACY_ACQUISITION_RETIRED"' "$RFILE" >/dev/null || { echo "FAIL: retired crawl expected 410"; exit 1; }
CRAWL_TASK_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.publish_tasks (tenant_id,agent_id,platform,status,task_type,payload) VALUES ('$TENANT_ID','$AGENT_ID','douyin','queued','crawl_comments/douyin',jsonb_build_object('video_url','https://www.douyin.com/video/7000000000000000001')) RETURNING id" | head -1)
[ -n "$CRAWL_TASK_ID" ] || { echo "FAIL historical crawl fixture"; exit 1; }

echo "=== Step 8: 上报历史采集任务的 5 条评论 ==="
COMMENTS_JSON='[{"commenter_id":"@douyin_user_001","text":"求联系方式","publish_time":"2026-05-10T10:00:00Z"},{"commenter_id":"@douyin_user_002","text":"装修预算多少","publish_time":"2026-05-10T10:01:00Z"},{"commenter_id":"@douyin_user_003","text":"小户型适用吗","publish_time":"2026-05-10T10:02:00Z"},{"commenter_id":"@douyin_user_004","text":"想看完整方案","publish_time":"2026-05-10T10:03:00Z"},{"commenter_id":"@douyin_user_005","text":"在哪个城市","publish_time":"2026-05-10T10:04:00Z"}]'
curl -fsS -X POST "$API_BASE/api/agent/burner/crawl-comments-result" \
  -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$CRAWL_TASK_ID\",\"agent_id\":\"$AGENT_ID\",\"video_url\":\"https://www.douyin.com/video/7000000000000000001\",\"comments\":$COMMENTS_JSON}" >/dev/null

CRAWL_STATUS=$(psql "$DB" -t -A -c "SELECT status FROM zenithjoy.publish_tasks WHERE id='$CRAWL_TASK_ID' AND updated_at > NOW() - interval '60 seconds'" | tr -d ' ')
[ "$CRAWL_STATUS" = "done" ] || { echo "FAIL Step 8: crawl task 未 done, got '$CRAWL_STATUS'"; exit 1; }

echo "=== Step 9: 验证 acquisition_leads 写入 5 条（本地 DB，不走飞书）==="
sleep 1
LEAD_COUNT=$(psql "$DB" -t -A -c "SELECT count(*) FROM zenithjoy.acquisition_leads WHERE tenant_id='$TENANT_ID' AND source_video_ids::text LIKE '%7000000000000000001%' AND created_at > NOW() - interval '60 seconds'")
[ "$LEAD_COUNT" -ge "5" ] || { echo "FAIL Step 9: acquisition_leads 写入数 $LEAD_COUNT < 5"; exit 1; }

# 验证 feishu_write_status='local_only'
STATUS_CHECK=$(psql "$DB" -t -A -c "SELECT count(*) FROM zenithjoy.acquisition_leads WHERE tenant_id='$TENANT_ID' AND feishu_write_status='local_only' AND created_at > NOW() - interval '60 seconds'")
[ "$STATUS_CHECK" -ge "5" ] || { echo "FAIL Step 9: feishu_write_status 非 local_only (count=$STATUS_CHECK)"; exit 1; }

echo "=== Step 10: 验证 dashboard 状态查询 ==="
curl -fsS "$API_BASE/api/agent/burner/crawl-tasks/$CRAWL_TASK_ID" \
  | jq -e '.data.status == "done" and .data.comment_count == 5 and .data.lead_write_status == "local_only"' >/dev/null \
  || { echo "FAIL Step 10: crawl task 状态查询不匹配"; exit 1; }

echo "✅ 旧创建已拒绝；历史绑定/采集回执及数据库测试通过；Skill/真机未验收"
