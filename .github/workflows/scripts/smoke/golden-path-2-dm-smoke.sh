#!/usr/bin/env bash
# Historical in-flight DM receipts: synthetic local PostgreSQL rows, actual
# result endpoint and disposable fake Feishu. Creation is retired and rejects.
# This does not send a real message or validate Skill/device execution.

set -euo pipefail

# ── 前置 ENV 自检 ──
[ -z "${API_BASE:-}" ] && { echo "FAIL: API_BASE 未设置"; exit 99; }
[ -z "${DB:-}" ] && { echo "FAIL: DB 未设置"; exit 99; }
[ -z "${FEISHU_API_BASE:-}" ] && { echo "FAIL: 未设置 FEISHU_API_BASE，CI 模式必须指向 fake server"; exit 99; }
[ -z "${SMOKE_TOKEN:-}" ] && { echo "FAIL: SMOKE_TOKEN 未设置"; exit 99; }

RESET_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${FEISHU_API_BASE}/__test/reset")
[ "$RESET_CODE" = "200" ] || { echo "FAIL: fake-feishu reset 失败 code=$RESET_CODE"; exit 1; }

echo "=== 前置 seed: tenant + 飞书 binding + agent + active burner session ==="
TENANT_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('smoke-dm-${RANDOM}', 'smoke-dm-key-${RANDOM}', 'free') RETURNING id" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
psql "$DB" -c "INSERT INTO zenithjoy.tenant_feishu_bindings (tenant_id, tenant_access_token, expires_at, app_token, table_id_lead_profile, table_id_target_videos, table_id_leads, bound_at) VALUES ('$TENANT_ID','fake_t_dm',NOW()+interval'1 hour','bascn_dm_app','tbl_dm_profile','tbl_dm_videos','tbl_b1_leads',NOW())" >/dev/null
AGENT_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, status) VALUES ('$TENANT_ID','xian-pc-dm-${RANDOM}','xian-pc','online') RETURNING id" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
LABEL="装修小号1"
psql "$DB" -c "INSERT INTO zenithjoy.agent_platform_sessions (agent_id, platform, account_label, role, status, bound_at, created_at) VALUES ('$AGENT_ID','douyin','$LABEL','burner','active',NOW(),NOW()) ON CONFLICT (agent_id,platform,account_label) DO UPDATE SET status='active'" >/dev/null

echo "=== Step 1: 种隔离数据库中的历史在途任务 ==="
# A historical in-flight task is inserted into the disposable PG fixture;
# this checks real result processing, not new dispatch or real message delivery.
seed_dm() {
 psql "$DB" -At -c "INSERT INTO zenithjoy.publish_tasks (tenant_id,agent_id,platform,status,task_type,payload) VALUES ('$TENANT_ID','$AGENT_ID','douyin','queued','dm_outreach',jsonb_build_object('tenant_id','$TENANT_ID','agent_id','$AGENT_ID','account_label','$LABEL','profile_url','$1')) RETURNING id" | head -1
}
DM_TASK_ID=$(seed_dm 'https://www.douyin.com/user/MS4waaa')
[ -n "$DM_TASK_ID" ] || { echo 'FAIL historical task fixture'; exit 1; }

echo "=== Step 2: fake-agent 取单 → 触达中 ==="
curl -sf -X POST "$API_BASE/api/_smoke/fake-agent-burner-progress" \
  -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$DM_TASK_ID\",\"phase\":\"dm_in_progress\",\"current_url\":\"https://www.douyin.com/user/MS4waaa\"}" >/dev/null
PHASE=$(psql "$DB" -t -A -c "SELECT response->>'phase' FROM zenithjoy.publish_tasks WHERE id='$DM_TASK_ID' AND status='running' AND updated_at > NOW() - interval '60 seconds'" | tr -d ' ')
[ "$PHASE" = "dm_in_progress" ] || { echo "FAIL Step 2: 触达中态未记录 (phase=$PHASE)"; exit 1; }

echo "=== Step 3: fake-agent 报 sent → task done + 飞书写「已私信」 ==="
RESP=$(curl -sf -X POST "$API_BASE/api/agent/burner/dm-outreach-result" \
  -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$DM_TASK_ID\",\"agent_id\":\"$AGENT_ID\",\"account_label\":\"$LABEL\",\"status\":\"sent\",\"profile_url\":\"https://www.douyin.com/user/MS4waaa\",\"screenshot_path\":\"/tmp/zj/dm-sent.png\"}")
echo "$RESP" | jq -e '.success == true and .data.status == "sent" and .data.lead_write_status == "success"' >/dev/null || { echo "FAIL Step 3: sent 回报 schema 不符"; exit 1; }
ST=$(psql "$DB" -t -A -c "SELECT status FROM zenithjoy.publish_tasks WHERE id='$DM_TASK_ID' AND updated_at > NOW() - interval '60 seconds'" | tr -d ' ')
[ "$ST" = "done" ] || { echo "FAIL Step 3: sent 后 task 未 done (st=$ST)"; exit 1; }
sleep 1
REC=$(curl -sf "${FEISHU_API_BASE}/__test/seen-records?table_id=tbl_b1_leads" | jq -c '.records[] | select(.["触达状态"]=="已私信")' | head -1)
[ -n "$REC" ] || { echo "FAIL Step 3: 飞书无「已私信」记录"; exit 1; }
echo "$REC" | jq -e '(.["触达小号"] | length > 0) and (.["触达时间"] | length > 0)' >/dev/null || { echo "FAIL Step 3: 已私信记录缺 触达小号/触达时间"; exit 1; }

echo "=== Step 4: 仅互关 → limited → 飞书写「未送达-仅互关」，禁假 sent ==="
DM2=$(seed_dm 'https://www.douyin.com/user/MS4wbbb')
[ -n "$DM2" ] || { echo 'FAIL historical limited fixture'; exit 1; }
curl -sf -X POST "$API_BASE/api/agent/burner/dm-outreach-result" \
  -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$DM2\",\"agent_id\":\"$AGENT_ID\",\"account_label\":\"$LABEL\",\"status\":\"limited\",\"profile_url\":\"https://www.douyin.com/user/MS4wbbb\"}" \
  | jq -e '.data.status == "limited"' >/dev/null || { echo "FAIL Step 4: limited 回报不符"; exit 1; }
sleep 1
ALL=$(curl -sf "${FEISHU_API_BASE}/__test/seen-records?table_id=tbl_b1_leads")
echo "$ALL" | jq -e '[.records[] | select(.["触达主页 URL"]=="https://www.douyin.com/user/MS4wbbb")] | any(.["触达状态"]=="未送达-仅互关")' >/dev/null || { echo "FAIL Step 4: 无 未送达-仅互关"; exit 1; }
echo "$ALL" | jq -e '[.records[] | select(.["触达主页 URL"]=="https://www.douyin.com/user/MS4wbbb")] | any(.["触达状态"]=="已私信") | not' >/dev/null || { echo "FAIL Step 4: limited 被错写成 已私信（假 sent）"; exit 1; }

echo "=== Step 5: SESSION_EXPIRED → task failed + 该号 expired + 另一号不连坐 ==="
psql "$DB" -c "INSERT INTO zenithjoy.agent_platform_sessions (agent_id, platform, account_label, role, status, bound_at, created_at) VALUES ('$AGENT_ID','douyin','装修小号2','burner','active',NOW(),NOW()) ON CONFLICT (agent_id,platform,account_label) DO UPDATE SET status='active'" >/dev/null
DM3=$(seed_dm 'https://www.douyin.com/user/MS4wccc')
[ -n "$DM3" ] || { echo 'FAIL historical failed fixture'; exit 1; }
# gate-allow: 下一步不是自我实现假测试——除了 error_code 读回，还直接断言了 HTTP 响应里
# session_disabled 真实副作用(服务端按 error_code 触发 session 失效的业务逻辑)，属于真实行为验证
curl -sf -X POST "$API_BASE/api/agent/burner/dm-outreach-result" \
  -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$DM3\",\"agent_id\":\"$AGENT_ID\",\"account_label\":\"$LABEL\",\"status\":\"failed\",\"error_code\":\"SESSION_EXPIRED\",\"profile_url\":\"https://www.douyin.com/user/MS4wccc\"}" \
  | jq -e '.data.status == "failed" and .data.session_disabled == true' >/dev/null || { echo "FAIL Step 5: failed 回报不符"; exit 1; }
ST=$(psql "$DB" -t -A -c "SELECT status FROM zenithjoy.publish_tasks WHERE id='$DM3'" | tr -d ' ')
EC=$(psql "$DB" -t -A -c "SELECT response->>'error_code' FROM zenithjoy.publish_tasks WHERE id='$DM3'" | tr -d ' ')
[ "$ST" = "failed" ] && [ "$EC" = "SESSION_EXPIRED" ] || { echo "FAIL Step 5: task 未 failed/error_code 错 (st=$ST ec=$EC)"; exit 1; }
S1=$(psql "$DB" -t -A -c "SELECT status FROM zenithjoy.agent_platform_sessions WHERE agent_id='$AGENT_ID' AND account_label='$LABEL' AND role='burner'" | tr -d ' ')
S2=$(psql "$DB" -t -A -c "SELECT status FROM zenithjoy.agent_platform_sessions WHERE agent_id='$AGENT_ID' AND account_label='装修小号2' AND role='burner'" | tr -d ' ')
[ "$S1" = "expired" ] || { echo "FAIL Step 5: 触达号未停用 (s1=$S1)"; exit 1; }
[ "$S2" = "active" ] || { echo "FAIL Step 5: 连坐了其他号 (s2=$S2)"; exit 1; }
sleep 1
curl -sf "${FEISHU_API_BASE}/__test/seen-records?table_id=tbl_b1_leads" | jq -e '[.records[] | select(.["触达主页 URL"]=="https://www.douyin.com/user/MS4wccc")] | any(.["触达状态"]=="失败" and (.["失败原因"]=="SESSION_EXPIRED"))' >/dev/null || { echo "FAIL Step 5: 飞书 失败原因 未写 SESSION_EXPIRED"; exit 1; }

echo "=== Step 6: 查状态端点终态 + 未知 task_id 404 NO_DM_TASK ==="
curl -sf "$API_BASE/api/agent/burner/dm-tasks/$DM_TASK_ID" \
  | jq -e '.success == true and .data.status == "done" and .data.dm_status == "sent" and (.data.feishu_bitable_url | type == "string")' >/dev/null \
  || { echo "FAIL Step 6: 查状态端点终态不匹配"; exit 1; }
CODE=$(curl -s -o /tmp/dm404.json -w '%{http_code}' "$API_BASE/api/agent/burner/dm-tasks/00000000-0000-0000-0000-000000000000")
[ "$CODE" = "404" ] || { echo "FAIL Step 6: 未知 task 应 404 got $CODE"; exit 1; }
jq -e '.error.code == "NO_DM_TASK"' /tmp/dm404.json >/dev/null || { echo "FAIL Step 6: 404 错码非 NO_DM_TASK"; exit 1; }

echo "=== Step 7: retired new dispatch is refused ==="
RFILE=$(mktemp); trap 'rm -f "$RFILE"' EXIT
BEFORE=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.publish_tasks WHERE tenant_id='$TENANT_ID'")
CODE=$(curl -s -o "$RFILE" -w '%{http_code}' -X POST "$API_BASE/api/agent/burner/dm-outreach" -H 'Content-Type: application/json' \
 -d "{\"tenant_id\":\"$TENANT_ID\",\"agent_id\":\"$AGENT_ID\",\"account_label\":\"$LABEL\",\"profile_url\":\"https://www.douyin.com/user/x\",\"message\":\"x\"}")
[ "$CODE" = 410 ] && jq -e '.error.code == "LEGACY_ACQUISITION_RETIRED"' "$RFILE" >/dev/null || { echo "FAIL: retired dispatch expected 410"; exit 1; }
AFTER=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.publish_tasks WHERE tenant_id='$TENANT_ID'")
[ "$BEFORE" = "$AFTER" ] || { echo "FAIL: retired dispatch created task"; exit 1; }
echo "Historical callbacks tested via actual HTTP+PG; no real message or Skill/device acceptance"
