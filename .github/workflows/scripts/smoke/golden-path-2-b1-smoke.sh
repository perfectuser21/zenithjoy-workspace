#!/usr/bin/env bash
# Path 2 Sprint B-1 — Golden Path E2E smoke
# 客户已绑飞书 → 绑抖音小号 → 抓视频评论 → 写飞书 Lead 表 → dashboard 查状态
#
# 落地合同 sprint-contract.md 的 E2E 段全文（10 Step + 4 ENV 自检 + 时间窗口 SELECT count）
set -euo pipefail

# 自检前置 ENV
[ -z "${API_BASE:-}" ] && { echo "FAIL: API_BASE 未设置"; exit 99; }
[ -z "${DB:-}" ] && { echo "FAIL: DB 未设置"; exit 99; }
[ -z "${FEISHU_API_BASE:-}" ] && { echo "FAIL: 未设置 FEISHU_API_BASE，CI 模式必须指向 fake server"; exit 99; }
[ -z "${SMOKE_TOKEN:-}" ] && { echo "FAIL: SMOKE_TOKEN 未设置（_smoke helper 必需）"; exit 99; }

echo "=== Step 1: 建 tenant + 飞书 binding seed ==="
TENANT_ID=$(psql "$DB" -t -A -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('smoke-b1-${RANDOM}', 'smoke-b1-key-${RANDOM}', 'free') RETURNING id" | tr -d ' ')
psql "$DB" -c "INSERT INTO zenithjoy.tenant_feishu_bindings (tenant_id, tenant_access_token, expires_at, app_token, table_id_lead_profile, table_id_target_videos, table_id_leads, bound_at) VALUES ('$TENANT_ID', 'fake_t_b1', NOW()+interval'1 hour', 'bascn_b1_app', 'tbl_b1_profile', 'tbl_b1_videos', 'tbl_b1_leads', NOW())" >/dev/null

# 飞书绑定状态查询
curl -fsS -X GET "$API_BASE/api/feishu/oauth/status" -H "X-Tenant-Id: $TENANT_ID" \
  | jq -e '.data.bound == true' >/dev/null \
  || { echo "FAIL Step 1: 飞书 binding 状态非 bound"; exit 1; }

echo "=== Step 2: 派 burner 绑定 task ==="
AGENT_ID=$(psql "$DB" -t -A -c "INSERT INTO zenithjoy.agents (tenant_id, machine_id, hostname, status) VALUES ('$TENANT_ID', 'mac-b1-${RANDOM}', 'rog-test', 'online') RETURNING id" | tr -d ' ')
RESP=$(curl -fsS -X POST "$API_BASE/api/agent/burner/qr-bind" \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"$TENANT_ID\",\"agent_id\":\"$AGENT_ID\",\"account_label\":\"装修小号1\"}")
TASK_ID_NEW=$(echo "$RESP" | jq -r '.data.task_id')
[ -n "$TASK_ID_NEW" ] && [ "$TASK_ID_NEW" != "null" ] || { echo "FAIL Step 2: 未返 task_id"; exit 1; }

# 验证 publish_tasks 写入（带时间窗口防造假）
COUNT=$(psql "$DB" -t -A -c "SELECT count(*) FROM zenithjoy.publish_tasks WHERE task_type='qr_bind/douyin_burner' AND created_at > NOW() - interval '60 seconds'")
[ "$COUNT" -ge "1" ] || { echo "FAIL Step 2: tasks 表未写入 (count=$COUNT)"; exit 1; }

# 错误路径：缺 account_label
ERR_HTTP=$(curl -s -o /tmp/err-step2.json -w '%{http_code}' -X POST "$API_BASE/api/agent/burner/qr-bind" \
  -H "Content-Type: application/json" -d "{\"tenant_id\":\"$TENANT_ID\",\"agent_id\":\"$AGENT_ID\"}")
[ "$ERR_HTTP" = "400" ] || { echo "FAIL Step 2 错误路径: 缺 account_label 应返 400 got $ERR_HTTP"; exit 1; }
jq -e '.error.code == "MISSING_ACCOUNT_LABEL"' /tmp/err-step2.json >/dev/null \
  || { echo "FAIL Step 2 错误路径: 错码非 MISSING_ACCOUNT_LABEL"; exit 1; }

echo "=== Step 3: fake-agent 模拟 chrome launched ==="
curl -fsS -X POST "$API_BASE/api/_smoke/fake-agent-burner-progress" \
  -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$TASK_ID_NEW\",\"phase\":\"chrome_launched\",\"user_data_dir\":\"/tmp/zj-burner/$AGENT_ID\",\"current_url\":\"https://creator.douyin.com/login\"}" >/dev/null

PHASE=$(psql "$DB" -t -A -c "SELECT response->>'phase' FROM zenithjoy.publish_tasks WHERE id='$TASK_ID_NEW' AND updated_at > NOW() - interval '60 seconds'" | tr -d ' ')
[ "$PHASE" = "chrome_launched" ] || { echo "FAIL Step 3: task phase != chrome_launched got '$PHASE'"; exit 1; }

echo "=== Step 4: fake-agent 模拟扫码完成 ==="
curl -fsS -X POST "$API_BASE/api/agent/burner/qr-bind-result" \
  -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$TASK_ID_NEW\",\"agent_id\":\"$AGENT_ID\",\"qr_login\":\"success\",\"cookie_local_path\":\"/tmp/zj-burner/sessions/douyin/burner/装修小号1.json\",\"account_nickname\":\"装修达人小号\"}" >/dev/null

STATUS=$(psql "$DB" -t -A -c "SELECT status FROM zenithjoy.publish_tasks WHERE id='$TASK_ID_NEW' AND updated_at > NOW() - interval '60 seconds'" | tr -d ' ')
[ "$STATUS" = "done" ] || { echo "FAIL Step 4: task 未 done, got '$STATUS'"; exit 1; }

# 验证 cookie 路径含 /burner/ 子目录
COOKIE_PATH=$(psql "$DB" -t -A -c "SELECT response->>'cookie_local_path' FROM zenithjoy.publish_tasks WHERE id='$TASK_ID_NEW'")
echo "$COOKIE_PATH" | grep -q "/burner/" || { echo "FAIL Step 4: cookie path 未含 /burner/: $COOKIE_PATH"; exit 1; }

echo "=== Step 5: 验证 agent_platform_sessions 写入 burner 行 ==="
SESSION_COUNT=$(psql "$DB" -t -A -c "SELECT count(*) FROM zenithjoy.agent_platform_sessions WHERE agent_id='$AGENT_ID' AND platform='douyin' AND role='burner' AND status='active' AND created_at > NOW() - interval '60 seconds'")
[ "$SESSION_COUNT" = "1" ] || { echo "FAIL Step 5: burner session 写入数 $SESSION_COUNT"; exit 1; }

echo "=== Step 6: dashboard 查询 burner sessions ==="
curl -fsS "$API_BASE/api/agent/burner/sessions?tenant_id=$TENANT_ID" \
  | jq -e '.data.sessions | length >= 1' >/dev/null \
  || { echo "FAIL Step 6: 无 burner sessions"; exit 1; }

echo "=== Step 7: 派抓评论 task ==="
RESP=$(curl -fsS -X POST "$API_BASE/api/agent/burner/crawl-comments" \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"$TENANT_ID\",\"agent_id\":\"$AGENT_ID\",\"account_label\":\"装修小号1\",\"video_url\":\"https://www.douyin.com/video/7000000000000000001\"}")
CRAWL_TASK_ID=$(echo "$RESP" | jq -r '.data.task_id')
[ -n "$CRAWL_TASK_ID" ] && [ "$CRAWL_TASK_ID" != "null" ] || { echo "FAIL Step 7: 未返 crawl task_id"; exit 1; }

CRAWL_COUNT=$(psql "$DB" -t -A -c "SELECT count(*) FROM zenithjoy.publish_tasks WHERE id='$CRAWL_TASK_ID' AND task_type='crawl_comments/douyin' AND created_at > NOW() - interval '60 seconds'")
[ "$CRAWL_COUNT" = "1" ] || { echo "FAIL Step 7: crawl task 未写入"; exit 1; }

echo "=== Step 8: fake-agent 上报 5 条评论 ==="
COMMENTS_JSON='[{"commenter_id":"@douyin_user_001","text":"求联系方式","publish_time":"2026-05-10T10:00:00Z"},{"commenter_id":"@douyin_user_002","text":"装修预算多少","publish_time":"2026-05-10T10:01:00Z"},{"commenter_id":"@douyin_user_003","text":"小户型适用吗","publish_time":"2026-05-10T10:02:00Z"},{"commenter_id":"@douyin_user_004","text":"想看完整方案","publish_time":"2026-05-10T10:03:00Z"},{"commenter_id":"@douyin_user_005","text":"在哪个城市","publish_time":"2026-05-10T10:04:00Z"}]'
curl -fsS -X POST "$API_BASE/api/agent/burner/crawl-comments-result" \
  -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$CRAWL_TASK_ID\",\"agent_id\":\"$AGENT_ID\",\"video_url\":\"https://www.douyin.com/video/7000000000000000001\",\"comments\":$COMMENTS_JSON}" >/dev/null

CRAWL_STATUS=$(psql "$DB" -t -A -c "SELECT status FROM zenithjoy.publish_tasks WHERE id='$CRAWL_TASK_ID' AND updated_at > NOW() - interval '60 seconds'" | tr -d ' ')
[ "$CRAWL_STATUS" = "done" ] || { echo "FAIL Step 8: crawl task 未 done, got '$CRAWL_STATUS'"; exit 1; }

echo "=== Step 9: 验证 fake-feishu-server 收到 5 次 records POST ==="
sleep 1
SEEN=$(curl -fsS "${FEISHU_API_BASE}/__test/seen-records?table_id=tbl_b1_leads" | jq -r '.count')
[ "$SEEN" -ge "5" ] || { echo "FAIL Step 9: 飞书 records 数 $SEEN < 5"; exit 1; }

# 验证写入字段含 5 列必需字段
RECORDS=$(curl -fsS "${FEISHU_API_BASE}/__test/seen-records?table_id=tbl_b1_leads" | jq -c '.records')
echo "$RECORDS" | jq -e '.[0] | has("评论者抖音 ID") and has("评论内容") and has("来源视频 URL") and has("抓取时间") and has("状态")' >/dev/null \
  || { echo "FAIL Step 9: 飞书 record 字段缺失"; exit 1; }

echo "=== Step 10: 验证 dashboard 状态查询 ==="
curl -fsS "$API_BASE/api/agent/burner/crawl-tasks/$CRAWL_TASK_ID" \
  | jq -e '.data.status == "done" and .data.comment_count == 5 and .data.lead_write_status == "success"' >/dev/null \
  || { echo "FAIL Step 10: crawl task 状态查询不匹配"; exit 1; }

echo "✅ Path 2 Sprint B-1 Golden Path E2E 全 10 步通过"
