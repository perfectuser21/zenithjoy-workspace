#!/usr/bin/env bash
# Path 2 — 抖音私信主动触达 Golden Path E2E smoke（fake-agent 模式）
#
# 落地 contract-draft.md 「## E2E 验收」段：派单 → fake-agent 回报 sent/limited/failed
#   → 查 DB task 状态 + 单号停用不连坐 + fake-feishu 校验 Lead 触达状态回写。
# 真发 CDP（semi-button-second 私信按钮 + contenteditable + Enter）由 xian-pc 真机手验，
#   证据另附 sprint，不入自动 E2E（PRD 范围限定）。
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

echo "=== Step 1: 派 dm_outreach 单 → DB 落 task_type=dm_outreach/platform=douyin/status=queued ==="
RESP=$(curl -sf -X POST "$API_BASE/api/agent/burner/dm-outreach" -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"$TENANT_ID\",\"agent_id\":\"$AGENT_ID\",\"account_label\":\"$LABEL\",\"profile_url\":\"https://www.douyin.com/user/MS4waaa\",\"message\":\"您好，看到您在评论区的提问\"}")
echo "$RESP" | jq -e '.success == true and (.data.task_id | type == "string")' >/dev/null || { echo "FAIL Step 1: 派单未返 data.task_id"; exit 1; }
DM_TASK_ID=$(echo "$RESP" | jq -r '.data.task_id')
C=$(psql "$DB" -t -A -c "SELECT count(*) FROM zenithjoy.publish_tasks WHERE id='$DM_TASK_ID' AND task_type='dm_outreach' AND platform='douyin' AND status='queued' AND created_at > NOW() - interval '60 seconds'")
[ "$C" = "1" ] || { echo "FAIL Step 1: dm_outreach task 未落库 (count=$C)"; exit 1; }

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
DM2=$(curl -sf -X POST "$API_BASE/api/agent/burner/dm-outreach" -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"$TENANT_ID\",\"agent_id\":\"$AGENT_ID\",\"account_label\":\"$LABEL\",\"profile_url\":\"https://www.douyin.com/user/MS4wbbb\",\"message\":\"hi\"}" | jq -r '.data.task_id')
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
DM3=$(curl -sf -X POST "$API_BASE/api/agent/burner/dm-outreach" -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"$TENANT_ID\",\"agent_id\":\"$AGENT_ID\",\"account_label\":\"$LABEL\",\"profile_url\":\"https://www.douyin.com/user/MS4wccc\",\"message\":\"hi\"}" | jq -r '.data.task_id')
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

echo "=== Step 7: 派单守卫错码 ==="
C1=$(curl -s -o /tmp/e1.json -w '%{http_code}' -X POST "$API_BASE/api/agent/burner/dm-outreach" -H "Content-Type: application/json" -d "{\"tenant_id\":\"$TENANT_ID\",\"agent_id\":\"$AGENT_ID\",\"account_label\":\"$LABEL\",\"message\":\"x\"}")
{ [ "$C1" = "400" ] && jq -e '.error.code == "MISSING_PROFILE_URL"' /tmp/e1.json >/dev/null; } || { echo "FAIL Step 7: 缺 profile_url 错码"; exit 1; }
C2=$(curl -s -o /tmp/e2.json -w '%{http_code}' -X POST "$API_BASE/api/agent/burner/dm-outreach" -H "Content-Type: application/json" -d "{\"tenant_id\":\"$TENANT_ID\",\"agent_id\":\"$AGENT_ID\",\"account_label\":\"$LABEL\",\"profile_url\":\"https://www.douyin.com/user/x\"}")
{ [ "$C2" = "400" ] && jq -e '.error.code == "MISSING_MESSAGE"' /tmp/e2.json >/dev/null; } || { echo "FAIL Step 7: 缺 message 错码"; exit 1; }
C3=$(curl -s -o /tmp/e3.json -w '%{http_code}' -X POST "$API_BASE/api/agent/burner/dm-outreach" -H "Content-Type: application/json" -d "{\"tenant_id\":\"$TENANT_ID\",\"agent_id\":\"$AGENT_ID\",\"account_label\":\"不存在的号\",\"profile_url\":\"https://www.douyin.com/user/x\",\"message\":\"x\"}")
{ [ "$C3" = "400" ] && jq -e '.error.code == "NO_BURNER_SESSION"' /tmp/e3.json >/dev/null; } || { echo "FAIL Step 7: 无 burner 错码"; exit 1; }

echo "✅ Path 2 抖音私信主动触达 Golden Path E2E 通过"
